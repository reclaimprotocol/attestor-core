FROM node:24.13.0

# install git
RUN apt update -y && apt upgrade -y && apt install git -y

COPY ./package.json /app/
COPY ./package-lock.json /app/
COPY ./tsconfig.json /app/
COPY ./tsconfig.build.json /app/
RUN mkdir -p /app/src/scripts
RUN echo '' > /app/src/scripts/prepare.sh
RUN echo 'console.log("TMP")' > /app/src/index.ts

WORKDIR /app

RUN npm i

COPY ./ /app

RUN npm run build
RUN npm run download:zk-files
RUN npm run build:browser
RUN npm prune --production

CMD ["npm", "run", "start"]
EXPOSE 8001
