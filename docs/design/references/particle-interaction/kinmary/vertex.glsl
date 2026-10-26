uniform vec2 uResolution;
uniform sampler2D uPictureTexture;
uniform sampler2D uDisplacementTexture;
uniform float uPointSize;
uniform float uDisplacementStrength;

attribute float aIntensity;
attribute float aAngle;

varying vec3 vColor;

void main()
{
    //Displacement
    vec3 newPosition = position;
    float displacementIntensity = texture(uDisplacementTexture, uv).r;
    displacementIntensity = smoothstep(0.1, 0.3, displacementIntensity);

    vec3 displacement = vec3(
        cos(aAngle) * 0.2,
        sin(aAngle) * 0.2,
        1.0
    );
    displacement = normalize(displacement);
    displacement *= displacementIntensity;
    displacement *= uDisplacementStrength;
    displacement *= aIntensity;
    newPosition += displacement;


    // Final position
    vec4 modelPosition = modelMatrix * vec4(newPosition, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;
    gl_Position = projectedPosition;

    //Picture
    //float pictureIntensity = texture(uPictureTexture, uv).r;

    // Picture color
    vec3 pictureColor = texture(uPictureTexture, uv).rgb;

    // Keep intensity for point size (luminance)
    float pictureIntensity = dot(pictureColor, vec3(1.0, 0.2, 0.05));

    // Point size
    gl_PointSize = uPointSize * uResolution.y * pictureIntensity;
    gl_PointSize *= (1.0 / - viewPosition.z);

    //Varyings
    vColor = pictureColor; //vec3(pow(pictureIntensity, 4.0));
}
