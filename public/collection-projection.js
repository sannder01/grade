/* CSS3D interop: use Three's existing world/camera to project the SAME planes.
 * Some WebKit builds lose homogeneous perspective across transformed parents.
 * A measured mismatch selects per-plane homographies with w=1 at their origin.
 * No user-agent detection, extra renderer, texture, or replacement image node.
 */
export function collectionProjection(root,engine,records) {
  const {T,camera}=engine, host=root.querySelector('[data-gallery-space]')
  const styles=new Map()
  function write(node,name,value) {
    if (!styles.has(node)) styles.set(node,new Map())
    const saved=styles.get(node)
    if (!saved.has(name)) saved.set(name,node.style.getPropertyValue(name))
    node.style.setProperty(name,value)
  }
  function corners(item,x,y,z,width,height,yaw=0) {
    const c=Math.cos(yaw),s=Math.sin(yaw)
    return [[-width/2,height/2],[width/2,height/2],[width/2,-height/2],[-width/2,-height/2]].map(([px,py])=>{
      const point=new T.Vector3(x+px*c,y+py,z-px*s).applyMatrix4(item.object.matrixWorld).project(camera)
      return {x:(point.x+1)*engine.width*.5,y:(1-point.y)*engine.height*.5}
    })
  }
  function bounds(points) {
    const xs=points.map(p=>p.x),ys=points.map(p=>p.y)
    return {x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}
  }
  function matrix(points,width,height) {
    const [p0,p1,p2,p3]=points
    const dx1=p1.x-p2.x,dx2=p3.x-p2.x,dx3=p0.x-p1.x+p2.x-p3.x
    const dy1=p1.y-p2.y,dy2=p3.y-p2.y,dy3=p0.y-p1.y+p2.y-p3.y
    const denominator=dx1*dy2-dx2*dy1
    const g=Math.abs(denominator)>1e-9?(dx3*dy2-dx2*dy3)/denominator:0
    const h=Math.abs(denominator)>1e-9?(dx1*dy3-dx3*dy1)/denominator:0
    const values=[(p1.x-p0.x+g*p1.x)/width,(p1.y-p0.y+g*p1.y)/width,0,g/width,
      (p3.x-p0.x+h*p3.x)/height,(p3.y-p0.y+h*p3.y)/height,0,h/height,
      0,0,1,0,p0.x,p0.y,0,1]
    return `matrix3d(${values.map(v=>Math.abs(v)<1e-12?0:v).join(',')})`
  }
  // Compare real DOM projection with the model, rather than guessing a browser
  // from its name. Both coordinates use the renderer's actual viewport origin.
  const selected=records[Math.max(0,Number(root.dataset.galleryActiveIndex)||0)]
  const width=selected.card.offsetWidth,height=selected.card.offsetHeight
  const expected=bounds(corners(selected,0,0,0,width,height))
  const actual=selected.card.getBoundingClientRect(),origin=host.getBoundingClientRect()
  const error=Math.max(Math.abs(actual.x-origin.x-expected.x),Math.abs(actual.y-origin.y-expected.y),Math.abs(actual.width-expected.width),Math.abs(actual.height-expected.height))
  if (!Number.isFinite(error)) throw new Error('Invalid collection projection')
  root.dataset.galleryProjectionError=error.toFixed(2)
  root.dataset.galleryProjection=error>3?'planes':'native'
  const projected=error>3
  function render() {
    if (!projected) return
    const mobile=engine.mobile,cardWidth=mobile?560:760,cardHeight=mobile?310:410
    const posterWidth=mobile?160:220,posterHeight=mobile?240:330,coverHeight=mobile?255:350,gap=mobile?20:24
    for (const item of records) {
      const center=new T.Vector3().setFromMatrixPosition(item.object.matrixWorld).applyMatrix4(camera.matrixWorldInverse)
      write(item.card,'--gallery-card-order',String(Math.round(10000+center.z)))
      const posters=[...item.card.querySelectorAll('.collection-cover>[data-poster-id]')].slice(0,3)
      posters.forEach((node,index)=>{
        const side=index-1,x=side*(posterWidth+gap)-(mobile?side*80:0),y=cardHeight/2-coverHeight/2-(side===0?-12:15),z=side===0?55:mobile?-65:-45
        const quad=corners(item,x,y,z,posterWidth,posterHeight,-side*(mobile?9:8)*Math.PI/180)
        write(node,'--gallery-plane',matrix(quad,posterWidth,posterHeight))
        write(node,'--gallery-plane-width',`${posterWidth}px`);write(node,'--gallery-plane-height',`${posterHeight}px`)
        write(node,'--gallery-plane-order',side===0?'3':'2')
      })
      const heading=item.card.querySelector('.collection-card-heading'),headingWidth=cardWidth-(mobile?44:64),headingHeight=21
      if (heading) {
        const y=cardHeight/2-coverHeight-(mobile?16:22)-headingHeight/2
        write(heading,'--gallery-heading-plane',matrix(corners(item,0,y,0,headingWidth,headingHeight),headingWidth,headingHeight))
        write(heading,'--gallery-heading-width',`${headingWidth}px`)
      }
    }
  }
  function cleanup() {
    for (const [node,properties] of styles) for (const [name,value] of properties) {
      if (value) node.style.setProperty(name,value);else node.style.removeProperty(name)
    }
    styles.clear();delete root.dataset.galleryProjection;delete root.dataset.galleryProjectionError
  }
  return {render,cleanup}
}
